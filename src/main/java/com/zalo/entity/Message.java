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


@Document(collection = "messages")
@Data
@Builder
@CompoundIndex(def = "{'conversationId': 1, 'createdAt': -1}")
public class Message {
    @Id
    private String id;

    private String conversationId;
    private String senderId;

    private String type; // TEXT, IMAGE, VIDEO...
    private String content;

    private Metadata metadata;
    private String replyTo; // ID của message cũ

    private String status; // SENDING, SENT, DELIVERED, SEEN
    private boolean isRecalled;
    private List<String> deletedBy; // Danh sách userId đã xóa phía họ

    private List<Reaction> reactions;
    private List<SeenBy> seenBy;

    @CreatedDate
    private LocalDateTime createdAt;

    @LastModifiedDate
    private LocalDateTime updatedAt;

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Metadata {
        private String fileName;
        private Long fileSize;
        private String thumbnail;
        private Double lat;
        private Double lng;
        private Integer duration;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Reaction {
        private String userId;
        private String type; // LIKE, LOVE...
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class SeenBy {
        private String userId;
        private LocalDateTime seenAt;
    }
}