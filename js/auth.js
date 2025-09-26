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

// ensure user profile exists in Firestore
async function ensureUserDoc(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      username: user.displayName || user.email,
      bio: "",
      role: "user",
      banned: false,
      createdAt: Date.now()
    });
    console.log("Created Firestore profile for", user.email);
  }
}

// Signup
export async function signup(email, password, username) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  await ensureUserDoc(cred.user);
  return cred.user;
}

// Login
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

// Logout
export function logout() {
  return signOut(auth);
}

// Auth redirect
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await ensureUserDoc(user);
    if (window.location.pathname.endsWith("login.html")) {
      window.location = "index.html";
    }
  } else {
    if (window.location.pathname.endsWith("index.html")) {
      window.location = "login.html";
    }
  }
});
