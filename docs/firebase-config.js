// ─────────────────────────────────────────────────────────────
// Firebase 설정값
//
// 캠프베이스가 연결할 공유 저장소(Firebase 프로젝트 campbase-f5df5) 정보예요.
// 이 값들은 비밀번호가 아니라 "어느 저장소에 연결할지" 알려주는
// 주소 같은 거라서 공개 저장소에 올려도 괜찮아요.
// 다른 Firebase 프로젝트로 바꾸려면 아래 { ... } 부분을
// 콘솔의 firebaseConfig 내용으로 통째로 바꾸면 돼요.
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDuKPO3HVqzdSpuwq_7whwNfaFZOqULge0",
  authDomain: "campbase-f5df5.firebaseapp.com",
  projectId: "campbase-f5df5",
  storageBucket: "campbase-f5df5.firebasestorage.app",
  messagingSenderId: "518727790712",
  appId: "1:518727790712:web:4ebacddfebd75062f1fd8d",
  measurementId: "G-9WV5VEL0HD"
};

// ↓ 이 줄은 지우지 마세요.
window.FIREBASE_CONFIG = firebaseConfig;
