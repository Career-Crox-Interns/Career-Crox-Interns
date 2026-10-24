// CC788: related modules consolidated; existing behavior preserved.
import React, { useLayoutEffect, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { applyPersonalSettings, readPersonalSettings } from '../lib/personalSettings';
import '../styles/genz-motion.css';
import { useLocation } from 'react-router-dom';

// Preserved from components/GlobalTextToneOverride.jsx
export function GlobalTextToneOverride() {
  useLayoutEffect(() => { document.getElementById('crm-global-text-tone-override')?.remove(); }, []);
  return null;
}

// Preserved from components/PersonalSettingsBridge.jsx
export function PersonalSettingsBridge() {
  const { user, theme }=useAuth();
  const location=useLocation();
  useLayoutEffect(()=>{document.documentElement.dataset.cc825Page=location.pathname.split('/')[1]||'home';},[location.pathname]);
  useLayoutEffect(()=>{
    const apply=()=>{ if(user) applyPersonalSettings(readPersonalSettings(),theme,user.role); };
    apply();
    window.addEventListener('cc787-settings-changed',apply);
    const onStorage=event=>{if(!event.key||event.key.startsWith('cc787:preferences:')||['careerCroxTheme','careerCroxCustomTheme','careerCroxCachedUser'].includes(event.key))apply();};
    window.addEventListener('storage',onStorage);
    return()=>{window.removeEventListener('cc787-settings-changed',apply);window.removeEventListener('storage',onStorage);};
  },[user,theme]);
  return null;
}

// Preserved from components/GenZMotionLayer.jsx
export function GenZMotionLayer() {
  const location = useLocation();
  useEffect(() => {
    const body = document.body;
    body.classList.remove('cc-genz-motion-enabled');
    body.classList.remove('cc-no-morph-motion');
    body.classList.add('cc785-premium-motion');
    return () => body.classList.remove('cc785-premium-motion');
  }, []);


  useEffect(() => {
    const page = document.querySelector('.cc785-route-content');
    if (!page || document.documentElement.dataset.cc787Motion==='reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const motion = page.animate([{ transform: 'translateY(3px)' }, { transform: 'translateY(0)' }], { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' });
    return () => motion.cancel();
  }, [location.pathname]);
  return null;
}
