package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func ListCurrentUserVoicePresets(ctx context.Context) ([]model.VoicePreset, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}
	return repository.ListUserVoicePresets(user.ID)
}

func SaveCurrentUserVoicePreset(ctx context.Context, input model.VoicePreset) (model.VoicePreset, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.VoicePreset{}, errors.New("请先登录")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return model.VoicePreset{}, errors.New("作品名称不能为空且不能超过 100 字")
	}
	description := strings.TrimSpace(input.Description)
	id := strings.TrimSpace(input.ID)
	update := id != ""
	createdAt := now()
	var existing model.VoicePreset
	if update {
		var found bool
		var err error
		existing, found, err = repository.GetUserVoicePreset(user.ID, id)
		if err != nil {
			return model.VoicePreset{}, err
		}
		if !found {
			return model.VoicePreset{}, errors.New("语音预设不存在或无权修改")
		}
		createdAt = existing.CreatedAt
		if description == "" {
			description = existing.Description
		}
	} else {
		id = newID("voice-preset")
	}
	if utf8.RuneCountInString(description) > 2000 {
		return model.VoicePreset{}, errors.New("作品说明不能超过 2000 字")
	}
	replaceRoles := input.Roles != nil
	if !update && len(input.Roles) == 0 {
		return model.VoicePreset{}, errors.New("新建语音预设至少需要一个角色")
	}
	if len(input.Roles) > 100 {
		return model.VoicePreset{}, errors.New("角色数量不能超过 100 个")
	}
	roles := make([]model.VoicePresetRole, 0, len(input.Roles))
	seenAliases := make(map[string]struct{}, len(input.Roles))
	existingRoles := make(map[string]model.VoicePresetRole, len(existing.Roles))
	for _, role := range existing.Roles {
		existingRoles[role.ID] = role
	}
	for _, role := range input.Roles {
		alias, voiceDesign := strings.TrimSpace(role.Alias), strings.TrimSpace(role.VoiceDesign)
		if alias == "" || voiceDesign == "" {
			return model.VoicePreset{}, errors.New("每个角色都需要填写代称和声音设计")
		}
		if utf8.RuneCountInString(alias) > 80 || utf8.RuneCountInString(voiceDesign) > 4000 {
			return model.VoicePreset{}, errors.New("角色代称不能超过 80 字，声音设计不能超过 4000 字")
		}
		key := strings.ToLower(alias)
		if _, exists := seenAliases[key]; exists {
			return model.VoicePreset{}, errors.New("同一作品中的角色代称不能重复")
		}
		seenAliases[key] = struct{}{}
		roleID, roleCreatedAt := strings.TrimSpace(role.ID), now()
		if roleID == "" {
			roleID = newID("voice-role")
		} else if existingRole, ok := existingRoles[roleID]; ok {
			roleCreatedAt = existingRole.CreatedAt
		} else {
			return model.VoicePreset{}, errors.New("角色 ID 不属于当前作品")
		}
		roles = append(roles, model.VoicePresetRole{ID: roleID, Alias: alias, VoiceDesign: voiceDesign, CreatedAt: roleCreatedAt, UpdatedAt: now()})
	}
	if !replaceRoles {
		roles = existing.Roles
	}
	item := model.VoicePreset{ID: id, UserID: user.ID, Name: name, Description: description, Roles: roles, CreatedAt: createdAt, UpdatedAt: now()}
	return repository.SaveUserVoicePreset(item, update, replaceRoles)
}

func DeleteCurrentUserVoicePreset(ctx context.Context, id string) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return errors.New("请先登录")
	}
	return repository.DeleteUserVoicePreset(user.ID, strings.TrimSpace(id))
}
