// js/chat.js
import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, orderBy, onSnapshot, doc as docRef, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const chatBox = document.getElementById("chat-box");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let unsubscribe = null;
let currentUserDoc = null;
let currentUserRole = "user";

function formatTime(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const uSnap = await getDoc(docRef(db, "users", user.uid));
  if (uSnap.exists()) {
    currentUserDoc = uSnap.data();
    currentUserRole = currentUserDoc.role || "user";

    // Force rename enforcement
    if (currentUserDoc.forceRename) {
      alert("An admin requested you change your username. Please update your profile.");
      window.location = "profile.html";
      return;
    }

    // If banned or bannedUntil -> sign out and show message
    const bannedUntil = currentUserDoc.bannedUntil;
    const now = Date.now();
    if (currentUserDoc.banned || (bannedUntil && (bannedUntil.toDate ? bannedUntil.toDate().getTime() : new Date(bannedUntil).getTime()) > now)) {
      alert("You are banned. Contact an admin.");
      await auth.signOut();
      return;
    }
  }

  startListening();
});

messageForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  const user = auth.currentUser;
  if (!user) {
    alert("Login required");
    return;
  }

  try {
    // Optionally check muted client-side
    const meSnap = await getDoc(docRef(db, "users", user.uid));
    if (meSnap.exists()) {
      const me = meSnap.data();
      const mutedUntil = me.mutedUntil;
      if (mutedUntil && (mutedUntil.toDate ? mutedUntil.toDate().getTime() : new Date(mutedUntil).getTime()) > Date.now()) {
        alert("You are muted and cannot send messages yet.");
        return;
      }
    }

    await addDoc(collection(db, "messages"), {
      uid: user.uid,
      username: user.displayName || user.email,
      photoURL: user.photoURL || "",
      text,
      createdAt: serverTimestamp()
    });
    messageInput.value = "";
  } catch (err) {
    console.error("Failed to send:", err);
    alert("Failed to send message: " + err.message);
  }
});

function startListening() {
  if (unsubscribe) unsubscribe();

  const q = query(collection(db, "messages"), orderBy("createdAt"));
  unsubscribe = onSnapshot(q, (snapshot) => {
    chatBox.innerHTML = "";
    snapshot.forEach((s) => {
      const msg = s.data();
      const id = s.id;
      const mine = msg.uid === auth.currentUser?.uid;

      const wrapper = document.createElement("div");
      wrapper.className = `chat-bubble ${mine ? "mine" : ""}`;

      const header = document.createElement("div");
      header.className = "chat-header";

      const name = document.createElement("span");
      name.className = "username";
      name.textContent = msg.username || "Unknown";

      header.appendChild(name);

      const body = document.createElement("div");
      body.className = "body";
      if (msg.text) body.textContent = msg.text;

      const ts = document.createElement("small");
      ts.className = "time";
      ts.textContent = formatTime(msg.createdAt);

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      wrapper.appendChild(ts);

      // Delete button - shown for owner/admin/moderator (rules enforce)
      if (msg.uid === auth.currentUser?.uid || currentUserRole === "admin" || currentUserRole === "GrandWizard" || currentUserRole === "moderator") {
        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.textContent = "🗑";
        delBtn.title = "Delete message";
        delBtn.addEventListener("click", async () => {
          if (!confirm("Delete this message?")) return;
          try {
            await deleteDoc(docRef(db, "messages", id));
          } catch (err) {
            console.error("delete error:", err);
            alert("Delete failed: " + err.message);
          }
        });
        wrapper.appendChild(delBtn);
      }

      // Report button for non-own messages
      if (msg.uid !== auth.currentUser?.uid) {
        const reportBtn = document.createElement("button");
        reportBtn.className = "report-btn";
        reportBtn.textContent = "🚩 Report";
        reportBtn.title = "Report this message";
        reportBtn.addEventListener("click", async () => {
          try {
            await addDoc(collection(db, "reports"), {
              messageId: id,
              uid: msg.uid,
              reporter: auth.currentUser.uid,
              ts: serverTimestamp(),
              status: "open"
            });
            alert("Reported. Thank you.");
          } catch (err) {
            console.error("report failed", err);
            alert("Report failed: " + err.message);
          }
        });
        wrapper.appendChild(reportBtn);
      }

      chatBox.appendChild(wrapper);
    });

    chatBox.scrollTop = chatBox.scrollHeight;
  }, (err) => {
    console.error("listen error:", err);
  });
}
