package service

import (
	"crypto/tls"
	"fmt"
	"log"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const videoTaskNotificationRecipient = "xiehaibo166@163.com"

func VideoTaskEmailNotificationsEnabled() bool {
	return strings.TrimSpace(config.Cfg.SMTPHost) != "" && strings.TrimSpace(config.Cfg.SMTPUsername) != "" &&
		strings.TrimSpace(config.Cfg.SMTPPassword) != "" && strings.TrimSpace(config.Cfg.SMTPFrom) != "" &&
		(config.Cfg.SMTPTLSMode == "ssl" || config.Cfg.SMTPTLSMode == "starttls")
}

func sendPendingVideoTaskEmailNotifications() {
	if !VideoTaskEmailNotificationsEnabled() {
		return
	}
	now := time.Now().UTC()
	retryBefore := videoTaskTime(now.Add(-time.Minute))
	tasks, err := repository.ListDueVideoTaskEmailNotifications(retryBefore, 20)
	if err != nil {
		log.Printf("list pending video email notifications failed: %v", err)
		return
	}
	for _, task := range tasks {
		attemptedAt := videoTaskTime(time.Now())
		claimed, err := repository.ClaimVideoTaskEmailNotification(task.ID, attemptedAt, retryBefore)
		if err != nil || !claimed {
			if err != nil {
				log.Printf("claim video email notification failed id=%s err=%v", task.ID, err)
			}
			continue
		}
		go processVideoTaskEmailNotification(task, attemptedAt)
	}
}

func processVideoTaskEmailNotification(task model.VideoTask, attemptedAt string) {
	if err := sendVideoTaskEmail(task); err != nil {
		_ = repository.UpdateVideoTaskEmailNotification(task.ID, "pending", attemptedAt)
		log.Printf("send video task email failed id=%s err=%v", task.ID, err)
		return
	}
	if err := repository.UpdateVideoTaskEmailNotification(task.ID, "sent", attemptedAt); err != nil {
		log.Printf("mark video task email sent failed id=%s err=%v", task.ID, err)
	}
}

func sendVideoTaskEmail(task model.VideoTask) error {
	host := strings.TrimSpace(config.Cfg.SMTPHost)
	port := strings.TrimSpace(config.Cfg.SMTPPort)
	if port == "" {
		port = "465"
	}
	address := net.JoinHostPort(host, port)
	var conn net.Conn
	var err error
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	if config.Cfg.SMTPTLSMode == "ssl" {
		conn, err = tls.DialWithDialer(dialer, "tcp", address, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if config.Cfg.SMTPTLSMode == "starttls" {
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			return fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	auth := smtp.PlainAuth("", config.Cfg.SMTPUsername, config.Cfg.SMTPPassword, host)
	if err := client.Auth(auth); err != nil {
		return err
	}
	if err := client.Mail(config.Cfg.SMTPFrom); err != nil {
		return err
	}
	if err := client.Rcpt(videoTaskNotificationRecipient); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	status := "成功"
	if IsFailedVideoTaskStatus(task.Status) {
		status = "失败"
	}
	completedAt := task.CompletedAt
	if completedAt == "" {
		completedAt = task.UpdatedAt
	}
	body := fmt.Sprintf("视频生成%s\r\n\r\n模型：%s\r\n任务 ID：%s\r\n来源：%s\r\n完成时间：%s\r\n", status, task.Model, task.ID, task.Source, completedAt)
	if status == "成功" && task.VideoURL != "" {
		body += "视频地址：" + cleanEmailHeader(task.VideoURL) + "\r\n"
	}
	if status == "失败" {
		body += "失败原因：" + cleanEmailHeader(firstVideoTaskValue(task.Error, task.ErrorDetail, "未知错误")) + "\r\n"
	}
	subject := mime.QEncoding.Encode("UTF-8", "视频生成"+status+" · "+task.Model)
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", cleanEmailHeader(config.Cfg.SMTPFrom), videoTaskNotificationRecipient, subject, time.Now().Format(time.RFC1123Z), body)
	if _, err := writer.Write([]byte(message)); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func cleanEmailHeader(value string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(strings.TrimSpace(value))
}
