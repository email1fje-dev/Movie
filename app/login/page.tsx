"use client";
import {useEffect} from "react";import {useRouter} from "next/navigation";
export default function Login(){const router=useRouter();useEffect(()=>router.replace("/"),[router]);return <div className="empty">Opening Movie Night...</div>}
