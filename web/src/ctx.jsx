import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
export const Me = createContext(null);
export const useMe = () => useContext(Me);
export const can = (me, ...caps) => caps.some((c) => me?.caps.includes(c));
/** عنوان الصفحة في الشريط العلوي */
export function Title({ children, sub }) {
  const [el, setEl] = useState(null);
  useEffect(() => setEl(document.getElementById('page-title')), []);
  return el ? createPortal(<div><h1>{children}</h1>{sub && <div className="sub">{sub}</div>}</div>, el) : null;
}
