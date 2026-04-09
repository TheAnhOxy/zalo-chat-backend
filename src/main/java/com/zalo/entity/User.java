package com.zalo.entity;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;

@Document(collection = "users")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User {
    @Id
    private String id;

    @Indexed(unique = true)
    private String phone;

    @Indexed(unique = true)
    private String email;

    private String password;
    private String fullName;
    private String avatar;
    private String coverImage;
    private LocalDate dob;
    private String gender;
    private String bio;

    private Status status;
    private Privacy privacy;
    private Settings settings;

    private List<String> fcmTokens;

    private boolean isVerified = false;
    private boolean isBlocked = false;

    @CreatedDate
    private LocalDateTime createdAt;

    @LastModifiedDate
    private LocalDateTime updatedAt;

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Status {
        private boolean isOnline;
        private LocalDateTime lastSeen;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Privacy {
        private String showPhone; // ALL, FRIEND, PRIVATE
        private boolean showOnline;
        private boolean allowStrangerMessage;
        private boolean findByPhone;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class Settings {
        private boolean darkMode;
        private String language;
        private boolean twoFactorAuth;
    }
}