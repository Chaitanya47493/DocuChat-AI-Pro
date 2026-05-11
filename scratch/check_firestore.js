import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

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
const db = getFirestore(app);

async function checkDocs() {
    try {
        const querySnapshot = await getDocs(collection(db, 'history'));
        console.log("Total docs in history:", querySnapshot.size);
        querySnapshot.forEach((doc) => {
            console.log(doc.id, " => ", doc.data().userId, " | ", doc.data().fileName);
        });
    } catch (e) {
        console.error("Error reading history:", e);
    }
}

checkDocs();
