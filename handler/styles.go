package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserStyles(w http.ResponseWriter, r *http.Request) {
	items, err := service.ListCurrentUserStyles(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, items)
}

func SaveUserStyle(w http.ResponseWriter, r *http.Request) {
	var item model.Style
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		Fail(w, "风格数据格式错误")
		return
	}
	saved, err := service.SaveCurrentUserStyle(r.Context(), item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, saved)
}

func DeleteUserStyle(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteCurrentUserStyle(r.Context(), id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
