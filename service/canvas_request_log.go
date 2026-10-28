package service

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const canvasRequestLogTextLimit = 60 * 1024

func SaveCanvasRequestLog(userID string, item model.AICallLog) error {
	item.ID = uuid.NewString()
	item.UserID = strings.TrimSpace(userID)
	item.UserDisplayName = ""
	item.NodeID = strings.TrimSpace(item.NodeID)
	item.Method = strings.TrimSpace(item.Method)
	item.Endpoint = strings.TrimSpace(item.Endpoint)
	item.Model = strings.TrimSpace(item.Model)
	item.RequestBody = limitCanvasRequestLogText(item.RequestBody)
	item.ResponseBody = limitCanvasRequestLogText(item.ResponseBody)
	item.Error = limitCanvasRequestLogText(item.Error)
	item.CreatedAt = time.Now().Format(time.RFC3339Nano)
	return repository.SaveCanvasRequestLog(item)
}

func ListCanvasRequestLogs(userID, nodeID string) ([]model.AICallLog, error) {
	return repository.ListCanvasRequestLogs(strings.TrimSpace(userID), strings.TrimSpace(nodeID))
}

func limitCanvasRequestLogText(value string) string {
	if len(value) <= canvasRequestLogTextLimit {
		return value
	}
	value = value[:canvasRequestLogTextLimit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
