//package com.zalo.repository;
//
//import com.zalo.entity.Call;
//import com.zalo.entity.Report;
//import com.zalo.entity.User;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.CommandLineRunner;
//import org.springframework.stereotype.Component;
//
//import java.time.LocalDateTime;
//
//@Component
//public class DataInitializer implements CommandLineRunner {
//
//    @Autowired private UserRepository userRepository;
//    @Autowired private CallRepository callRepository;   // Cần tạo Interface này trước
//    @Autowired private ReportRepository reportRepository; // Cần tạo Interface này trước
//
//    @Override
//    public void run(String... args) throws Exception {
//        // 1. Kích hoạt bảng Users
//        if (userRepository.count() == 0) {
//            userRepository.save(User.builder().phone("0000000000").fullName("System").build());
//        }
//
//        // 2. Kích hoạt bảng Calls
//        if (callRepository.count() == 0) {
//            Call dummyCall = new Call();
//            dummyCall.setCallerId("system_id");
//            dummyCall.setStatus("ENDED");
//            callRepository.save(dummyCall);
//            System.out.println(">>>> Đã kích hoạt bảng CALLS");
//        }
//
//        // 3. Kích hoạt bảng Reports
//        if (reportRepository.count() == 0) {
//            Report dummyReport = new Report();
//            dummyReport.setReason("Khởi tạo hệ thống");
//            reportRepository.save(dummyReport);
//            System.out.println(">>>> Đã kích hoạt bảng REPORTS");
//        }
//    }
//}