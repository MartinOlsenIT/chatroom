import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, orderBy, onSnapshot, doc as docRef, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const chatBox = document.getElementById("chat-box");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let currentUserRole = "user";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const snap = await getDoc(docRef(db, "users", user.uid));
  if (snap.exists()) {
    const data = snap.data();
    currentUserRole = data.role;
    if (data.banned) {
      alert("You are banned.");
      auth.signOut();
      return;
    }
  }
});

messageForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  const user = auth.currentUser;

  await addDoc(collection(db, "messages"), {
    uid: user.uid,
    username: user.displayName || user.email,
    text,
    createdAt: serverTimestamp()
  });

  messageInput.value = "";
});

const q = query(collection(db, "messages"), orderBy("createdAt"));
onSnapshot(q, (snapshot) => {
  chatBox.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const msg = docSnap.data();
    const id = docSnap.id;

    const div = document.createElement("div");
    div.className = "chat-message";

    const name = document.createElement("span");
    name.className = "username";
    name.textContent = msg.username;
    name.addEventListener("click", () => openProfile(msg.uid));

    const text = document.createElement("p");
    text.textContent = msg.text;

    div.appendChild(name);
    div.appendChild(text);

    if (msg.uid === auth.currentUser?.uid || currentUserRole === "admin") {
      const btn = document.createElement("button");
      btn.textContent = "Delete";
      btn.addEventListener("click", () => deleteDoc(docRef(db, "messages", id)));
      div.appendChild(btn);
    }

    chatBox.appendChild(div);
  });
  chatBox.scrollTop = chatBox.scrollHeight;
});

async function openProfile(uid) {
  const snap = await getDoc(docRef(db, "users", uid));
  if (!snap.exists()) return alert("Profile not found");
  const data = snap.data();
  alert(`Username: ${data.username}\nEmail: ${data.email}\nBio: ${data.bio}\nRole: ${data.role}`);
}
