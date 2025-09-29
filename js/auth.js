// js/auth.js
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function signup(email, password, username) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email: cred.user.email,
    username,
    bio: "",
    role: "user",
    banned: false,
    mutedUntil: null,
    shadowBanned: false,
    forceRename: false,
    createdAt: Date.now()
  });
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function logout() {
  return signOut(auth);
}

// Global auth watcher: redirect logic is handled in chat/profile where needed
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // If on login page redirect to index
    if (window.location.pathname.endsWith("login.html")) {
      window.location = "index.html";
    }
  } else {
    if (window.location.pathname.endsWith("index.html") || window.location.pathname.endsWith("admin.html") || window.location.pathname.endsWith("profile.html")) {
      window.location = "login.html";
    }
  }
});
