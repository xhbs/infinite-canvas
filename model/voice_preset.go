package model

// VoicePreset stores voice design for roles in a work.
type VoicePreset struct {
	ID          string            `json:"id" gorm:"primaryKey"`
	UserID      string            `json:"userId" gorm:"index:idx_voice_presets_user_updated,priority:1"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty" gorm:"type:text"`
	Roles       []VoicePresetRole `json:"roles" gorm:"foreignKey:PresetID;references:ID"`
	CreatedAt   string            `json:"createdAt"`
	UpdatedAt   string            `json:"updatedAt" gorm:"index:idx_voice_presets_user_updated,priority:2"`
}

// VoicePresetRole describes a role alias and its voice for a work.
type VoicePresetRole struct {
	ID          string `json:"id" gorm:"primaryKey"`
	PresetID    string `json:"presetId" gorm:"index:idx_voice_preset_roles_owner,priority:1"`
	UserID      string `json:"userId" gorm:"index:idx_voice_preset_roles_owner,priority:2"`
	Alias       string `json:"alias"`
	VoiceDesign string `json:"voiceDesign" gorm:"type:text"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}
