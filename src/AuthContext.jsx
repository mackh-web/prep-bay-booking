import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './apiClient';
const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);
export function AuthProvider({children}) {
 const [user,setUser]=useState(null),[loading,setLoading]=useState(true);
 useEffect(()=>{api.get('/auth/me').then(r=>setUser(r.data)).catch(()=>setUser(null)).finally(()=>setLoading(false))},[]);
 const login=async(email,password)=>{const r=await api.post('/auth/login',{email,password});setUser(r.data);};
 const logout=async()=>{await api.post('/auth/logout');setUser(null)};
 return <Ctx.Provider value={{user,loading,login,logout}}>{children}</Ctx.Provider>;
}
