package service

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

type UpyunReferenceUploadInput struct {
	Operator  string
	Password  string
	Bucket    string
	PublicURL string
	ObjectKey string
	MimeType  string
	Size      int64
	Body      io.Reader
}

type UpyunReferenceObject struct {
	URL      string `json:"url"`
	ObjectKey string `json:"objectKey"`
}

var upyunBucketPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// UploadUpyunReference sends the image from the local canvas server to Upyun
// using the operator REST API credentials supplied for this one request.
func UploadUpyunReference(ctx context.Context, input UpyunReferenceUploadInput) (UpyunReferenceObject, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return UpyunReferenceObject{}, errors.New("请先登录后使用又拍云上传")
	}
	operator, password := strings.TrimSpace(input.Operator), input.Password
	bucket := strings.TrimSpace(input.Bucket)
	publicURL := strings.TrimRight(strings.TrimSpace(input.PublicURL), "/")
	key := strings.Trim(strings.TrimSpace(input.ObjectKey), "/")
	if operator == "" || strings.TrimSpace(password) == "" || !upyunBucketPattern.MatchString(bucket) {
		return UpyunReferenceObject{}, errors.New("又拍云配置不完整")
	}
	parsedPublicURL, err := url.Parse(publicURL)
	if err != nil || parsedPublicURL.Host == "" || parsedPublicURL.Scheme != "https" || parsedPublicURL.User != nil || parsedPublicURL.RawQuery != "" || parsedPublicURL.Fragment != "" {
		return UpyunReferenceObject{}, errors.New("又拍云公开访问地址必须是有效的 HTTPS 地址")
	}
	if input.Size <= 0 || input.Size > 50*1024*1024 || input.Body == nil {
		return UpyunReferenceObject{}, errors.New("参考图片必须大于 0 且不超过 50 MB")
	}
	if strings.TrimSpace(input.MimeType) == "" {
		input.MimeType = "application/octet-stream"
	}
	prefix := "canvas-reference/" + user.ID + "/"
	if !strings.HasPrefix(key, prefix) || strings.Contains(key, "\\") {
		return UpyunReferenceObject{}, errors.New("又拍云对象路径无效")
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return UpyunReferenceObject{}, errors.New("又拍云对象路径无效")
		}
	}
	uri := "/" + bucket + "/" + encodeUpyunKey(key)
	date := time.Now().UTC().Format(http.TimeFormat)
	authorization := upyunAuthorization(operator, password, http.MethodPut, uri, date)
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, "https://v0.api.upyun.com"+uri, input.Body)
	if err != nil {
		return UpyunReferenceObject{}, err
	}
	request.ContentLength = input.Size
	request.Header.Set("Date", date)
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", input.MimeType)
	client := &http.Client{Timeout: 2 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return UpyunReferenceObject{}, errors.New("连接又拍云失败，请检查网络和操作员权限")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusNoContent {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return UpyunReferenceObject{}, fmt.Errorf("上传又拍云失败（HTTP %d）%s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return UpyunReferenceObject{URL: publicURL + "/" + key, ObjectKey: key}, nil
}

func DeleteUpyunReference(ctx context.Context, operator, password, bucket, objectKey string) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return errors.New("请先登录后删除又拍云参考图")
	}
	operator, bucket = strings.TrimSpace(operator), strings.TrimSpace(bucket)
	key := strings.Trim(strings.TrimSpace(objectKey), "/")
	if operator == "" || strings.TrimSpace(password) == "" || !upyunBucketPattern.MatchString(bucket) {
		return errors.New("又拍云配置不完整")
	}
	if !strings.HasPrefix(key, "canvas-reference/"+user.ID+"/") || strings.Contains(key, "\\") {
		return errors.New("又拍云对象路径无效")
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return errors.New("又拍云对象路径无效")
		}
	}
	uri := "/" + bucket + "/" + encodeUpyunKey(key)
	date := time.Now().UTC().Format(http.TimeFormat)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, "https://v0.api.upyun.com"+uri, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Date", date)
	request.Header.Set("Authorization", upyunAuthorization(operator, password, http.MethodDelete, uri, date))
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return errors.New("连接又拍云失败，参考图稍后可重试清理")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusOK || response.StatusCode == http.StatusNoContent {
		return nil
	}
	detail, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
	return fmt.Errorf("删除又拍云参考图失败（HTTP %d）%s", response.StatusCode, strings.TrimSpace(string(detail)))
}

func upyunAuthorization(operator, password, method, uri, date string) string {
	passwordDigest := md5.Sum([]byte(password))
	mac := hmac.New(sha1.New, []byte(hex.EncodeToString(passwordDigest[:])))
	_, _ = io.WriteString(mac, method+"&"+uri+"&"+date)
	return "UPYUN " + operator + ":" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func encodeUpyunKey(key string) string {
	segments := strings.Split(key, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}
