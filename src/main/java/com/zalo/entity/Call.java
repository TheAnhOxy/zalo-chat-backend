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

@Document(collection = "calls")
@Data
public class Call {
    @Id
    private String id;
    private String conversationId;
    private String callerId;
    private List<String> participants;
    private String type; // VOICE, VIDEO
    private String status; // CALLING, ACCEPTED, REJECTED, MISSED, ENDED
    private LocalDateTime startedAt;
    private LocalDateTime endedAt;
    private Integer duration;

    @CreatedDate
    private LocalDateTime createdAt;
}
