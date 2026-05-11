import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, googleProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loginWithGoogle = () => {
    return signInWithPopup(auth, googleProvider);
  };

  const loginWithEmail = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = (email, password) => {
    return createUserWithEmailAndPassword(auth, email, password);
  };

  const resetPassword = (email) => {
    return sendPasswordResetEmail(auth, email);
  };

  const logout = () => {
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loginWithGoogle, loginWithEmail, registerWithEmail, resetPassword, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
