package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

var safeProxyHTTPClient = newSafeProxyHTTPClient()

var (
	imageProxyHTTPClientMu  sync.Mutex
	imageProxyHTTPClientURL string
	imageProxyHTTPClient    *http.Client
)

func SafeProxyHTTPClient() *http.Client {
	return safeProxyHTTPClient
}

func ImageProxyHTTPClient() (*http.Client, error) {
	proxyURL := strings.TrimSpace(config.Cfg.ImageProxyURL)
	if proxyURL == "" {
		return SafeProxyHTTPClient(), nil
	}

	imageProxyHTTPClientMu.Lock()
	defer imageProxyHTTPClientMu.Unlock()
	if imageProxyHTTPClient != nil && imageProxyHTTPClientURL == proxyURL {
		return imageProxyHTTPClient, nil
	}
	client, err := newImageProxyHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}
	imageProxyHTTPClientURL = proxyURL
	imageProxyHTTPClient = client
	return client, nil
}

func newSafeProxyHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = safeProxyDialContext
	return newSafeProxyHTTPClientWithTransport(transport)
}

func newSafeProxyHTTPClientWithTransport(transport http.RoundTripper) *http.Client {
	return &http.Client{
		Transport: transport,
		Timeout:   5 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return errors.New("重定向次数过多")
			}
			scheme := strings.ToLower(req.URL.Scheme)
			if scheme != "http" && scheme != "https" {
				return errors.New("重定向地址无效")
			}
			return nil
		},
	}
}

func newImageProxyHTTPClient(rawProxyURL string) (*http.Client, error) {
	proxyURL, err := url.Parse(rawProxyURL)
	if err != nil {
		return nil, errors.New("图片代理地址无效")
	}
	if strings.ToLower(proxyURL.Scheme) != "http" ||
		proxyURL.Hostname() == "" ||
		proxyURL.Port() == "" ||
		proxyURL.User != nil ||
		(proxyURL.Path != "" && proxyURL.Path != "/") ||
		proxyURL.RawQuery != "" ||
		proxyURL.Fragment != "" {
		return nil, errors.New("图片代理地址无效")
	}
	proxyIPs, err := net.DefaultResolver.LookupIPAddr(context.Background(), proxyURL.Hostname())
	if err != nil || len(proxyIPs) == 0 {
		return nil, errors.New("无法解析图片代理地址")
	}
	for _, item := range proxyIPs {
		if !item.IP.IsLoopback() {
			return nil, errors.New("图片代理必须监听在本机")
		}
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(proxyURL)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != proxyURL.Host {
			return nil, errors.New("图片代理连接地址无效")
		}
		return (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, network, address)
	}
	return newSafeProxyHTTPClientWithTransport(safeImageProxyRoundTripper{transport: transport}), nil
}

type safeImageProxyRoundTripper struct {
	transport *http.Transport
}

func (t safeImageProxyRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := validateSafeProxyTarget(request.Context(), request.URL); err != nil {
		return nil, err
	}
	return t.transport.RoundTrip(request)
}

func validateSafeProxyTarget(ctx context.Context, targetURL *url.URL) error {
	if targetURL == nil || targetURL.Hostname() == "" {
		return errors.New("目标地址无效")
	}
	scheme := strings.ToLower(targetURL.Scheme)
	if scheme != "http" && scheme != "https" {
		return errors.New("目标地址无效")
	}
	ips, err := resolveSafeProxyHost(ctx, targetURL.Hostname())
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return errors.New("无法解析目标地址")
	}
	return nil
}

func safeProxyDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := resolveSafeProxyHost(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	var lastErr error
	for _, item := range ips {
		conn, err := dialer.DialContext(
			ctx,
			network,
			net.JoinHostPort(item.String(), port),
		)
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("无法连接目标地址: %w", lastErr)
}

func resolveSafeProxyHost(ctx context.Context, host string) ([]net.IPAddr, error) {
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("无法解析目标地址")
	}
	for _, item := range ips {
		if isBlockedProxyIP(item.IP) {
			return nil, errors.New("禁止访问本地或内网地址")
		}
	}
	return ips, nil
}

func isBlockedProxyIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified() {
		return true
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	// 100.64.0.0/10，包括部分云平台 metadata 地址。
	if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return true
	}
	return ip4[0] == 0
}
