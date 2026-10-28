package handler

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestParseVideoTaskPayloadUnwrapsNestedAICostResponse(t *testing.T) {
	payload := []byte(`{
  "data": {
    "code": "success",
    "data": {
      "action": "textGenerate",
      "data": {
        "status": "processing",
        "progress": "55%",
        "task_id": 60568,
        "url": null,
        "urls": [],
        "error": null
      }
    },
    "progress": "55%"
  }
}`)

	got := parseVideoTaskPayload(payload, "seedance2.5-900")
	if got.Status != "processing" {
		t.Fatalf("status = %q, want processing", got.Status)
	}
	if got.Progress != 55 {
		t.Fatalf("progress = %d, want 55", got.Progress)
	}
	if got.UpstreamTaskID != "60568" {
		t.Fatalf("upstream task id = %q, want 60568", got.UpstreamTaskID)
	}
	if got.Error != "" {
		t.Fatalf("error = %q, want empty", got.Error)
	}
}

func TestParseEmbeddedVideoTaskPayloadKeepsProcessingState(t *testing.T) {
	message := `poll failed: unrecognized (HTTP 200): Unknown AICost video status: ; body={"data":{"code":"success","data":{"data":{"status":"processing","task_id":62567},"progress":"55%"}}}`
	got, ok := parseEmbeddedVideoTaskPayload(message, "seedance2.5-900")
	if !ok {
		t.Fatal("expected embedded task payload to be recognized")
	}
	if got.Status != "processing" {
		t.Fatalf("status = %q, want processing", got.Status)
	}
	if got.Progress != 55 {
		t.Fatalf("progress = %d, want 55", got.Progress)
	}
	if got.UpstreamTaskID != "62567" {
		t.Fatalf("task id = %q, want 62567", got.UpstreamTaskID)
	}
	if got.Error != "" {
		t.Fatalf("error = %q, want empty", got.Error)
	}
}

func TestParseVideoTaskPayloadRecognizesAICostContentURL(t *testing.T) {
	payload := []byte(`{
  "data": {
    "code": "success",
    "content": "https://www.aicost.me/static-custom/generated-videos/result.mp4",
    "data": {
      "status": "charged",
      "content_url": "https://www.aicost.me/static-custom/generated-videos/result.mp4"
    }
  }
}`)

	got := parseVideoTaskPayload(payload, "seedance2.5-900")
	if got.Status != "completed" {
		t.Fatalf("status = %q, want completed", got.Status)
	}
	if got.VideoURL == "" {
		t.Fatal("video URL is empty")
	}
}

func TestParseEmbeddedVideoTaskPayloadRecoversTruncatedAICostBody(t *testing.T) {
	message := `poll failed: unrecognized (HTTP 200): Unknown AICost video status: ; body={"data":{"code":"success","content":"https://www.aicost.me/static-custom/generated-videos/result.mp4","data":{"status":"charged","content_url":"https://www.aicost.me/static-custom/generated-videos/result.mp4","download_url":"https://www.aicost.me/static-custom/generated-videos/result.mp4","downl`
	got, ok := parseEmbeddedVideoTaskPayload(message, "seedance2.5-900")
	if !ok {
		t.Fatal("expected truncated embedded payload to be recognized")
	}
	if got.Status != "completed" {
		t.Fatalf("status = %q, want completed", got.Status)
	}
	if got.VideoURL != "https://www.aicost.me/static-custom/generated-videos/result.mp4" {
		t.Fatalf("video URL = %q", got.VideoURL)
	}
}

func TestHongchengVideoStatusUnwrapsSucceededTaskFromAdapterError(t *testing.T) {
	body, err := json.Marshal(map[string]any{
		"content_url": "https://hongcheng.lol/media/video-results/task_123",
		"data": map[string]any{
			"status":    "succeeded",
			"video_url": "https://hongcheng.lol/media/video-results/task_123",
			"task_id":   "task_123",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{
		"error": map[string]any{"message": fmt.Sprintf("Unknown Hongcheng video status: succeeded; body=%s", body)},
	})
	if err != nil {
		t.Fatal(err)
	}

	transformed := transformAIProtocolVideoPayload(payload, nil, model.ModelChannel{Name: "Hongcheng"}, "model", true)
	got := parseVideoTaskPayload(transformed, "model")
	if got.Status != "completed" {
		t.Fatalf("status = %q, want completed", got.Status)
	}
	if got.VideoURL != "https://hongcheng.lol/media/video-results/task_123" {
		t.Fatalf("video URL = %q", got.VideoURL)
	}
}
