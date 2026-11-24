package service

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

type aiCallLogContextKey struct{}

func WithAICallLog(ctx context.Context, input AICallLogInput) context.Context {
	return context.WithValue(ctx, aiCallLogContextKey{}, input)
}

func AICallLogFromContext(ctx context.Context) AICallLogInput {
	input, _ := ctx.Value(aiCallLogContextKey{}).(AICallLogInput)
	return input
}

// Capture the actual HTTP request after provider parameter translation.
func CaptureAIRequestLog(request *http.Request, stage string) AICallLogInput {
	input := AICallLogFromContext(request.Context())
	input.Endpoint, input.Method, input.Stage = request.URL.String(), request.Method, stage
	input.OutcomeKnown = true
	input.RequestBody = ""
	if request.GetBody == nil {
		return input
	}
	reader, err := request.GetBody()
	if err != nil {
		return input
	}
	defer reader.Close()
	if mediaType, params, err := mime.ParseMediaType(request.Header.Get("Content-Type")); err == nil && mediaType == "multipart/form-data" {
		form, err := multipart.NewReader(reader, params["boundary"]).ReadForm(32 << 20)
		if err != nil {
			input.RequestBody = "multipart/form-data"
			return input
		}
		defer form.RemoveAll()
		files := []map[string]any{}
		for field, headers := range form.File {
			for _, header := range headers {
				files = append(files, map[string]any{"field": field, "filename": header.Filename, "size": header.Size, "contentType": header.Header.Get("Content-Type")})
			}
		}
		encoded, _ := json.Marshal(map[string]any{"fields": form.Value, "files": files})
		input.RequestBody = string(encoded)
	} else {
		body, _ := io.ReadAll(reader)
		input.RequestBody = string(body)
	}
	return input
}

// Remove known credentials even when a provider embeds them in a URL or error.
func SaveUpstreamAICallLog(input AICallLogInput, secrets ...string) {
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		encoded, _ := json.Marshal(secret)
		for _, value := range []string{secret, string(encoded[1 : len(encoded)-1]), url.QueryEscape(secret), url.PathEscape(secret)} {
			input.Endpoint = strings.ReplaceAll(input.Endpoint, value, "[密钥]")
			input.RequestBody = strings.ReplaceAll(input.RequestBody, value, "[密钥]")
			input.ResponseBody = strings.ReplaceAll(input.ResponseBody, value, "[密钥]")
			input.Error = strings.ReplaceAll(input.Error, value, "[密钥]")
		}
	}
	_ = SaveAICallLog(input)
}
