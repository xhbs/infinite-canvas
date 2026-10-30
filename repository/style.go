package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListUserStyles(userID string) ([]model.Style, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := []model.Style{}
	err = db.Where("user_id = ?", userID).Order("updated_at desc").Find(&items).Error
	return items, err
}

func GetUserStyle(userID, id string) (model.Style, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Style{}, false, err
	}
	var item model.Style
	err = db.Where("user_id = ? AND id = ?", userID, id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Style{}, false, nil
	}
	return item, err == nil, err
}

func SaveUserStyle(item model.Style) (model.Style, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

func DeleteUserStyle(userID, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("user_id = ? AND id = ?", userID, id).Delete(&model.Style{}).Error
}
