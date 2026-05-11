import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDFfSU-N98YfXiHt5kbGzmxOoFSSbms66k",
  authDomain: "mini-project-2969b.firebaseapp.com",
  projectId: "mini-project-2969b",
  storageBucket: "mini-project-2969b.firebasestorage.app",
  messagingSenderId: "294253478643",
  appId: "1:294253478643:web:72f7939085f13ae53d6d86",
  measurementId: "G-VTXS6783T4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
