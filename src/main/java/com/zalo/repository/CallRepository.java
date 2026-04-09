package com.zalo.repository;

import com.zalo.entity.Call;
import com.zalo.entity.User;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CallRepository  extends MongoRepository<Call, String> {
}
