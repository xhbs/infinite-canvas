package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func ListCurrentUserStyles(ctx context.Context) ([]model.Style, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}
	return repository.ListUserStyles(user.ID)
}

func SaveCurrentUserStyle(ctx context.Context, input model.Style) (model.Style, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.Style{}, errors.New("请先登录")
	}
	name, prompt := strings.TrimSpace(input.Name), strings.TrimSpace(input.Prompt)
	if name == "" || prompt == "" {
		return model.Style{}, errors.New("请输入风格名称和描述")
	}
	if utf8.RuneCountInString(name) > 80 || utf8.RuneCountInString(prompt) > 4000 {
		return model.Style{}, errors.New("风格名称不能超过 80 字，描述不能超过 4000 字")
	}
	appliesTo := input.AppliesTo
	if appliesTo != "image" && appliesTo != "video" && appliesTo != "both" {
		return model.Style{}, errors.New("风格适用范围无效")
	}
	id := strings.TrimSpace(input.ID)
	createdAt := now()
	if id != "" {
		existing, found, err := repository.GetUserStyle(user.ID, id)
		if err != nil {
			return model.Style{}, err
		}
		if !found {
			return model.Style{}, errors.New("风格不存在或无权修改")
		}
		createdAt = existing.CreatedAt
	} else {
		id = newID("style")
	}
	item := model.Style{ID: id, UserID: user.ID, Name: name, Prompt: prompt, AppliesTo: appliesTo, CreatedAt: createdAt, UpdatedAt: now()}
	return repository.SaveUserStyle(item)
}

func DeleteCurrentUserStyle(ctx context.Context, id string) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return errors.New("请先登录")
	}
	return repository.DeleteUserStyle(user.ID, strings.TrimSpace(id))
}
