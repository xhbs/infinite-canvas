package model

// Style 是用户保存的生成风格。
type Style struct {
	ID        string `json:"id" gorm:"primaryKey"`
	UserID    string `json:"userId" gorm:"index:idx_styles_user_updated,priority:1"`
	Name      string `json:"name"`
	Prompt    string `json:"prompt" gorm:"type:text"`
	AppliesTo string `json:"appliesTo"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt" gorm:"index:idx_styles_user_updated,priority:2"`
}
