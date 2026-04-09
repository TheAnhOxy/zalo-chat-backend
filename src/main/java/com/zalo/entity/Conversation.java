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

@Document(collection = "conversations")
@Data
@Builder
@CompoundIndex(def = "{'members.userId': 1}")
public class Conversation {
    @Id
    private String id;

    private String type; // PRIVATE, GROUP
    private String name;
    private String avatar;

    private List<Member> members;
    private LastMessage lastMessage;
    private GroupSettings groupSettings;

    @CreatedDate
    private LocalDateTime createdAt;

    @LastModifiedDate
    private LocalDateTime updatedAt;

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Member {
        private String userId;
        private String role; // ADMIN, MODERATOR, MEMBER
        private String nickname;
        private LocalDateTime joinedAt;
        private boolean isMuted;
        private boolean isPinned;
        private boolean isHidden;
        private String hiddenPin;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class LastMessage {
        private String messageId;
        private String content;
        private String senderId;
        private LocalDateTime createdAt;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class GroupSettings {
        private boolean allowInviteLink;
        private String joinQrCode;
        private boolean isLockChat;
    }
}