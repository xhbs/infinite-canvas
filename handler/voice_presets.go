package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserVoicePresets(w http.ResponseWriter, r *http.Request) {
	items, err := service.ListCurrentUserVoicePresets(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, items)
}

func SaveUserVoicePreset(w http.ResponseWriter, r *http.Request) {
	var item model.VoicePreset
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		Fail(w, "语音预设数据格式错误")
		return
	}
	saved, err := service.SaveCurrentUserVoicePreset(r.Context(), item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, saved)
}

func DeleteUserVoicePreset(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteCurrentUserVoicePreset(r.Context(), id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
