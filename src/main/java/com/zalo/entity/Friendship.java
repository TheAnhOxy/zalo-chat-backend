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

@Document(collection = "friendships")
@Data
@CompoundIndex(def = "{'requesterId': 1, 'addresseeId': 1}", unique = true)
public class Friendship {
    @Id
    private String id;

    private String requesterId;
    private String addresseeId;

    private String status; // PENDING, ACCEPTED, BLOCKED

    @CreatedDate
    private LocalDateTime createdAt;

    @LastModifiedDate
    private LocalDateTime updatedAt;
}