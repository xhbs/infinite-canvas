package repository

import "github.com/tigerowo/infinite-canvas/model"

const maxCanvasRequestLogsPerNode = 200

func SaveCanvasRequestLog(item model.AICallLog) error {
	db, err := DB()
	if err != nil {
		return err
	}
	if err := db.Create(&item).Error; err != nil {
		return err
	}
	var oldIDs []string
	if err := db.Model(&model.AICallLog{}).
		Where("user_id = ? AND node_id = ?", item.UserID, item.NodeID).
		Order("created_at DESC").Offset(maxCanvasRequestLogsPerNode).Pluck("id", &oldIDs).Error; err != nil {
		return err
	}
	if len(oldIDs) > 0 {
		return db.Where("id IN ?", oldIDs).Delete(&model.AICallLog{}).Error
	}
	return nil
}

func ListCanvasRequestLogs(userID, nodeID string) ([]model.AICallLog, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.AICallLog
	err = db.Where("user_id = ? AND node_id = ?", userID, nodeID).
		Order("created_at DESC").Limit(maxCanvasRequestLogsPerNode).Find(&items).Error
	return items, err
}
