package com.zalo.entity;

import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;


@Document(collection = "reports")
@Data
public class Report {
    @Id
    private String id;
    private String reporterId;
    private String targetUserId;
    private String reason;
    private String description;
    private String status; // PENDING, RESOLVED

    @CreatedDate
    private LocalDateTime createdAt;
}