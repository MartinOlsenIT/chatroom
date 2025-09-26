import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC9GImIs3OTF2JQGsJMjY7t9hgt7UC5ARk",
  authDomain: "chatroom-3023e.firebaseapp.com",
  projectId: "chatroom-3023e",
  storageBucket: "chatroom-3023e.firebasestorage.app",
  messagingSenderId: "1016525443777",
  appId: "1:1016525443777:web:4ab0109704a0dcb1b4fa40"

};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
