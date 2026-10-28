package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func SaveCanvasRequestLog(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		Fail(w, "请先登录")
		return
	}
	var item model.AICallLog
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&item); err != nil {
		Fail(w, "请求日志格式错误或内容过大")
		return
	}
	if item.NodeID == "" {
		Fail(w, "缺少节点 ID")
		return
	}
	if err := service.SaveCanvasRequestLog(user.ID, item); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func UserCanvasRequestLogs(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		Fail(w, "请先登录")
		return
	}
	nodeID := strings.TrimSpace(r.URL.Query().Get("nodeId"))
	if nodeID == "" {
		Fail(w, "缺少节点 ID")
		return
	}
	items, err := service.ListCanvasRequestLogs(user.ID, nodeID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"items": items, "total": len(items)})
}
