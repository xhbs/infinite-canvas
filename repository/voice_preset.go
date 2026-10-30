package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListUserVoicePresets(userID string) ([]model.VoicePreset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := []model.VoicePreset{}
	err = db.Preload("Roles", "user_id = ?", userID).Where("user_id = ?", userID).Order("updated_at desc").Find(&items).Error
	return items, err
}

func SaveUserVoicePreset(item model.VoicePreset, update, replaceRoles bool) (model.VoicePreset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var existing model.VoicePreset
		err := tx.Where("user_id = ? AND id = ?", item.UserID, item.ID).First(&existing).Error
		if update {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return gorm.ErrRecordNotFound
			}
			if err != nil {
				return err
			}
		} else if err == nil {
			return gorm.ErrDuplicatedKey
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if item.CreatedAt == "" {
			item.CreatedAt = item.UpdatedAt
		}
		if err := tx.Omit("Roles").Save(&item).Error; err != nil {
			return err
		}
		if !replaceRoles {
			return nil
		}
		if err := tx.Where("preset_id = ? AND user_id = ?", item.ID, item.UserID).Delete(&model.VoicePresetRole{}).Error; err != nil {
			return err
		}
		if len(item.Roles) == 0 {
			return nil
		}
		for i := range item.Roles {
			item.Roles[i].PresetID = item.ID
			item.Roles[i].UserID = item.UserID
			if item.Roles[i].CreatedAt == "" {
				item.Roles[i].CreatedAt = item.UpdatedAt
			}
			if item.Roles[i].UpdatedAt == "" {
				item.Roles[i].UpdatedAt = item.UpdatedAt
			}
		}
		return tx.Create(&item.Roles).Error
	})
	return item, err
}

func GetUserVoicePreset(userID, id string) (model.VoicePreset, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VoicePreset{}, false, err
	}
	var item model.VoicePreset
	err = db.Preload("Roles", "user_id = ?", userID).Where("user_id = ? AND id = ?", userID, id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.VoicePreset{}, false, nil
	}
	return item, err == nil, err
}

func DeleteUserVoicePreset(userID, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("preset_id = ? AND user_id = ?", id, userID).Delete(&model.VoicePresetRole{}).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ? AND id = ?", userID, id).Delete(&model.VoicePreset{}).Error
	})
}
