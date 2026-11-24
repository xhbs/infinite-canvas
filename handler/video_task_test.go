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

func TestParseVideoTaskPayloadUnwrapsLLMTokenTaskResult(t *testing.T) {
	payload := []byte(`{
  "success": true,
  "task": {
    "id": "tuc_video_aa80e289-5bc4-468d-a56f-f5ed024672d9",
    "task_id": "tuc_video_aa80e289-5bc4-468d-a56f-f5ed024672d9",
    "status": "completed",
    "videoUrl": "/llm-api/video/assets/2026-11-12/result.mp4",
    "video_url": "/llm-api/video/assets/2026-11-12/result.mp4",
    "outputUrl": "/llm-api/video/assets/2026-11-12/result.mp4",
    "output_url": "/llm-api/video/assets/2026-11-12/result.mp4"
  }
}`)

	got := parseVideoTaskPayload(payload, "kaka-seedance2_5-full")
	if got.Status != "completed" {
		t.Fatalf("status = %q, want completed", got.Status)
	}
	if got.UpstreamTaskID != "tuc_video_aa80e289-5bc4-468d-a56f-f5ed024672d9" {
		t.Fatalf("upstream task id = %q", got.UpstreamTaskID)
	}
	wantURL := "/llm-api/video/assets/2026-11-12/result.mp4"
	if got.VideoURL != wantURL {
		t.Fatalf("video URL = %q, want %q", got.VideoURL, wantURL)
	}
	if got := normalizeVideoResultURL(got.VideoURL, "https://llmtoken.io/v1/"); got != "https://llmtoken.io/llm-api/video/assets/2026-11-12/result.mp4" {
		t.Fatalf("normalized video URL = %q", got)
	}
}

func TestNormalizeVideoResultURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		base string
		want string
	}{
		{name: "absolute", raw: "https://media.example/video.mp4", base: "https://llmtoken.io/v1/", want: "https://media.example/video.mp4"},
		{name: "root relative", raw: "/media/video.mp4?token=abc", base: "https://llmtoken.io/v1/", want: "https://llmtoken.io/media/video.mp4?token=abc"},
		{name: "api relative", raw: "files/video.mp4", base: "https://llmtoken.io/v1/", want: "https://llmtoken.io/v1/files/video.mp4"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeVideoResultURL(test.raw, test.base); got != test.want {
				t.Fatalf("normalizeVideoResultURL() = %q, want %q", got, test.want)
			}
		})
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
