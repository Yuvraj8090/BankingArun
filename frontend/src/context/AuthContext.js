import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  // Regulated capabilities this institution may currently offer; the sidebar
  // and route guard hide anything not in this list.
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('banking_token') || null);

  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
  const API = `${BACKEND_URL}/api`;

  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = localStorage.getItem('banking_token');
      if (!savedToken) {
        setUser(false);
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
          withCredentials: true
        });
        if (res.data?.user) {
          setUser(res.data.user);
          if (Array.isArray(res.data.features)) setFeatures(res.data.features);
        } else {
          setUser(false);
        }
      } catch (err) {
        localStorage.removeItem('banking_token');
        setUser(false);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [API]);

  const login = async (email, password, deviceName = "Web Portal") => {
    const res = await axios.post(`${API}/auth/login`, {
      email,
      password,
      device_name: deviceName
    }, { withCredentials: true });

    if (res.data?.token) {
      localStorage.setItem('banking_token', res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      if (Array.isArray(res.data.features)) setFeatures(res.data.features);
    }
    return res.data;
  };

  const register = async (formData) => {
    const res = await axios.post(`${API}/auth/register`, formData, { withCredentials: true });
    if (res.data?.token) {
      localStorage.setItem('banking_token', res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
      if (Array.isArray(res.data.features)) setFeatures(res.data.features);
    }
    return res.data;
  };

  const logout = async () => {
    try {
      if (token) {
        await axios.post(`${API}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${token}` },
          withCredentials: true
        });
      }
    } catch (e) {
      // ignore
    } finally {
      localStorage.removeItem('banking_token');
      setToken(null);
      setUser(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, setUser, features }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
