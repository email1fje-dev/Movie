import "./globals.css";
import Link from "next/link";
export const metadata={title:"Movie Night",description:"Watch movies together in sync."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><header><Link href="/" className="brand">🍿 Movie Night</Link><nav><Link href="/">Movies</Link><Link href="/admin">Admin</Link><Link href="/login">Login</Link></nav></header><main>{children}</main></body></html>}