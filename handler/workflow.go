package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/service"
)

func UserWorkflows(w http.ResponseWriter, r *http.Request) {
	workflows, err := service.ListCreativeWorkflows(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, workflows)
}

func SaveUserWorkflow(w http.ResponseWriter, r *http.Request) {
	var request service.CreativeWorkflowPayload
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "工作流数据格式错误")
		return
	}
	workflow, err := service.SaveCreativeWorkflow(r.Context(), request)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, workflow)
}

func DeleteUserWorkflow(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteCreativeWorkflow(r.Context(), id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func DraftUserWorkflow(w http.ResponseWriter, r *http.Request) {
	var request service.WorkflowAgentDraftRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "工作流需求格式错误")
		return
	}
	result, err := service.DraftCreativeWorkflow(r.Context(), request)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminAICallLogs(w http.ResponseWriter, r *http.Request) {
	list, err := service.ListAICallLogs(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, list)
}

// ClientAICallLog 接收前端本地直连渠道的 AI 调用日志上报。
func ClientAICallLog(w http.ResponseWriter, r *http.Request) {
	var request service.AICallLogInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&request); err != nil {
		Fail(w, "日志数据格式错误或超过大小限制")
		return
	}
	if err := service.SaveClientAICallLog(r.Context(), request); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func NodeAICallLogs(w http.ResponseWriter, r *http.Request) {
	list, err := service.ListNodeAICallLogs(r.Context(), r.URL.Query().Get("nodeId"), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, list)
}

func AdminDeleteAICallLogs(w http.ResponseWriter, r *http.Request) {
	days := 7
	if v := r.URL.Query().Get("olderThanDays"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			days = parsed
		}
	}
	removed, err := service.DeleteAICallLogsOlderThan(days)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]int{"removedFiles": removed})
}
