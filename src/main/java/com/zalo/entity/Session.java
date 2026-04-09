package com.zalo.entity;

import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;


@Document(collection = "sessions")
@Data
@Builder
public class Session {
    @Id
    private String id;

    @Indexed
    private String userId;

    private String device; // web, android, ios
    private String deviceName;
    private String ip;
    private String refreshToken;
    private LocalDateTime expiredAt;
    private boolean isActive;

    @CreatedDate
    private LocalDateTime createdAt;
}