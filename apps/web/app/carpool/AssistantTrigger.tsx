"use client";
import {OPEN_CHAT_EVENT,type OpenChatDetail} from "../ChatWidget";
/** Opens the single shared assistant; no second chat session or audio recorder. */
export function AssistantTrigger({draft,className,children}:{draft?:string;className?:string;children:React.ReactNode}){
 return <button type="button" className={className} onClick={()=>window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT,{detail:{draft}}))}>{children}</button>;
}
