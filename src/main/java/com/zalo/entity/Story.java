package com.zalo.entity;

import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;


@Document(collection = "stories")
@Data
public class Story {
    @Id
    private String id;
    private String userId;
    private String mediaUrl;
    private String type; // IMAGE, VIDEO
    private String caption;
    private List<String> viewers;

    @Indexed(expireAfter = "0s") // TTL Index tự động xóa khi đến ngày expiresAt
    private LocalDateTime expiresAt;

    @CreatedDate
    private LocalDateTime createdAt;
}