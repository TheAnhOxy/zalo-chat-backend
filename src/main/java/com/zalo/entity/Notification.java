package com.zalo.entity;

import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;


@Document(collection = "notifications")
@Data
public class Notification {
    @Id
    private String id;

    @Indexed
    private String receiverId;

    private String type; // MESSAGE, FRIEND_REQUEST...
    private String content;

    private NotificationData data;
    private boolean isRead = false;

    @CreatedDate
    private LocalDateTime createdAt;

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class NotificationData {
        private String senderId;
        private String conversationId;
        private String messageId;
    }
}