package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

type parameterTranslationProgressKey struct{}

func parameterTranslationLogInput(r *http.Request, channel model.ModelChannel, user model.AuthUser, modelName string, credits float64) service.AICallLogInput {
	input := aiRequestLogAssociation(r)
	input.UserID, input.UserDisplayName = user.ID, firstNonEmpty(user.DisplayName, user.Username)
	input.Model, input.ChannelID, input.ChannelName, input.Credits = modelName, channel.ID, channel.Name, credits
	return input
}

func serveParameterTranslation(w http.ResponseWriter, r *http.Request, body []byte, path string, channel model.ModelChannel, user model.AuthUser, credits float64, startedAt time.Time) bool {
	input, err := service.ReadParameterTranslationInput(body)
	if input == nil && err == nil {
		return false
	}
	if err == nil && ((input.Kind == "image" && path != "/images/generations" && path != "/images/edits") || (input.Kind == "audio" && path != "/audio/speech") || input.Kind == "video") {
		Fail(w, "自定义调用类型与接口不一致")
		return true
	}
	var request struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &request)
	var translation *service.ParameterTranslation
	if err == nil {
		translation, err = service.NewParameterTranslation(channel, request.Model, input.Variables)
	}
	if err != nil {
		Fail(w, err.Error())
		return true
	}
	if translation == nil {
		Fail(w, "当前渠道没有该模型的自定义配置，请刷新渠道设置")
		return true
	}
	if r.Header.Get("X-Canvas-Node-Request") == "true" && r.Context().Err() != nil {
		return true
	}
	if credits > 0 {
		if err := service.ConsumeUserCredits(user.ID, request.Model, credits, path); err != nil {
			FailError(w, err)
			return true
		}
	}
	logContext := parameterTranslationLogInput(r, channel, user, request.Model, credits)
	onProgress, _ := r.Context().Value(parameterTranslationProgressKey{}).(func(int))
	result, err := translation.Execute(service.WithAICallLog(r.Context(), logContext), input.Kind, onProgress)
	if err != nil {
		if credits > 0 && (r.Header.Get("X-Canvas-Node-Request") != "true" || r.Context().Err() == nil) {
			_ = service.RefundUserCredits(user.ID, request.Model, credits, path)
		}
		Fail(w, err.Error())
		return true
	}
	if len(result.Body) > 0 {
		w.Header().Set("Content-Type", result.ContentType)
		_, _ = w.Write(result.Body)
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	if input.Kind == "audio" {
		_ = json.NewEncoder(w).Encode(map[string]any{"provider": "parameter-translation", "audio_url": result.URLs[0]})
		return true
	}
	images := make([]map[string]string, 0, len(result.URLs))
	for _, url := range result.URLs {
		images = append(images, map[string]string{"url": url})
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": images})
	return true
}

func serveParameterTranslationVideo(w http.ResponseWriter, r *http.Request, body []byte, channel model.ModelChannel, user model.AuthUser, credits float64, startedAt time.Time) bool {
	input, err := service.ReadParameterTranslationInput(body)
	if input == nil && err == nil {
		return false
	}
	if err == nil && input.Kind != "video" {
		Fail(w, "自定义调用类型与视频接口不一致")
		return true
	}
	var request struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &request)
	var translation *service.ParameterTranslation
	if err == nil {
		translation, err = service.NewParameterTranslation(channel, request.Model, input.Variables)
	}
	if err != nil {
		Fail(w, err.Error())
		return true
	}
	if translation == nil {
		Fail(w, "当前渠道没有该模型的自定义配置，请刷新渠道设置")
		return true
	}
	if credits > 0 {
		if err := service.ConsumeUserCredits(user.ID, request.Model, credits, "/videos"); err != nil {
			FailError(w, err)
			return true
		}
	}
	logContext := parameterTranslationLogInput(r, channel, user, request.Model, credits)
	result, err := translation.Send(service.WithAICallLog(r.Context(), logContext), "video", false, "")
	if err != nil {
		if id := readClientVideoTaskID(r); id != "" {
			if task, found, _ := service.GetUserVideoTask(user.ID, id); found && task.Status == "cancelled" {
				Fail(w, "任务已停止")
				return true
			}
		}
		if credits > 0 {
			refundVideoCredits(user.ID, request.Model, credits, "/videos")
		}
		Fail(w, err.Error())
		return true
	}
	videoURL := ""
	if len(result.URLs) > 0 {
		videoURL = result.URLs[0]
	}
	userChannelID := r.Header.Get(userModelChannelHeader)
	seconds, size := "", ""
	if value, ok := input.Variables["seconds"]; ok {
		seconds = fmt.Sprint(value)
	}
	if value, ok := input.Variables["size"]; ok {
		size = fmt.Sprint(value)
	}
	task, err := service.CreateVideoTask(service.VideoTaskCreateInput{
		UserID: user.ID, UserDisplayName: logContext.UserDisplayName, Model: request.Model, ChannelID: channel.ID, UserChannelID: userChannelID, ChannelName: channel.Name,
		Source: readVideoTaskSource(r), SourceID: readVideoTaskSourceID(r), ClientTaskID: readClientVideoTaskID(r), Status: result.Status, Progress: result.Progress,
		Seconds: seconds, Size: size,
		VideoURL: videoURL, RequestBody: string(body), ResponseBody: result.ResponseBody, Credits: credits, ParameterTranslationSnapshot: translation.Snapshot(*input, result),
	})
	if err != nil {
		if credits > 0 {
			refundVideoCredits(user.ID, request.Model, credits, "/videos")
		}
		Fail(w, "视频任务保存失败")
		return true
	}
	if len(result.Body) > 0 {
		w.Header().Set("Content-Type", result.ContentType)
		_, _ = w.Write(result.Body)
		return true
	}
	OK(w, service.VideoTaskResponse(task))
	return true
}
