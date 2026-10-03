import React, { useEffect } from 'react';
import '../styles/genz-motion.css';

// CC26_86: Navigation bounce/morph disabled.
// The previous Gen-Z layer added route-pop, hover scale, spark and floating
// animations. In the recorded test video, every slice click looked like the
// CRM stepped back and came forward. This component now only applies the
// no-motion guard class and renders nothing, so route changes stay instant
// and stable.
export default function GenZMotionLayer() {
  useEffect(() => {
    const body = document.body;
    body.classList.remove('cc-genz-motion-enabled');
    body.classList.add('cc-no-morph-motion');
    return () => body.classList.remove('cc-no-morph-motion');
  }, []);

  return null;
}
