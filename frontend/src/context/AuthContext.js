import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { setAuthToken } from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  // Regulated capabilities this institution may currently offer; the sidebar
  // and route guard hide anything not in this list.
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);
  // Set while a bank owner is viewing a member's account (modules/impersonation.php).
  const [impersonation, setImpersonation] = useState(null);

  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
  const API = `${BACKEND_URL}/api`;

  useEffect(() => {
    // The session itself lives in the httpOnly cookie the server set on
    // login, so a reload restores it from there — no token needs to sit in
    // browser storage for this to work. (See services/api.js for why.)
    const checkAuth = async () => {
      try {
        const res = await axios.get(`${API}/auth/me`, { withCredentials: true });
        if (res.data?.user) {
          setUser(res.data.user);
          if (Array.isArray(res.data.features)) setFeatures(res.data.features);
          setImpersonation(res.data.impersonation || null);
        } else {
          setUser(false);
        }
      } catch (err) {
        setUser(false);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [API]);

  const login = async (email, password, deviceName = "Web Portal", extra = {}) => {
    const res = await axios.post(`${API}/auth/login`, {
      email,
      password,
      device_name: deviceName,
      ...extra
    }, { withCredentials: true });

    if (res.data?.token) {
      setAuthToken(res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      if (Array.isArray(res.data.features)) setFeatures(res.data.features);
    }
    return res.data;
  };

  const register = async (formData) => {
    const res = await axios.post(`${API}/auth/register`, formData, { withCredentials: true });
    if (res.data?.token) {
      setAuthToken(res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      if (Array.isArray(res.data.features)) setFeatures(res.data.features);
    }
    return res.data;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        withCredentials: true
      });
    } catch (e) {
      // ignore
    } finally {
      setAuthToken(null);
      setToken(null);
      setUser(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, setUser, features, impersonation }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
