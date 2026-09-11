#pragma once
#include <windows.h>
#include <string>
#include <sstream>
#include <stdexcept>
#include <cwctype>
struct Hotkey{UINT modifiers{},key{};};
inline Hotkey ParseHotkey(std::wstring const& text){
    if(text.empty()||text.back()==L'+')throw std::runtime_error("Unsupported hotkey");
    Hotkey result{MOD_NOREPEAT,0};std::wistringstream stream(text);std::wstring token;
    while(std::getline(stream,token,L'+')){
        for(auto& c:token)c=wchar_t(std::towupper(c));
        UINT modifier=token==L"CTRL"?MOD_CONTROL:token==L"ALT"?MOD_ALT:token==L"SHIFT"?MOD_SHIFT:token==L"WIN"?MOD_WIN:0;
        if(modifier){if(result.modifiers&modifier)throw std::runtime_error("Repeated modifier");result.modifiers|=modifier;continue;}
        UINT key=token==L"SPACE"?VK_SPACE:(token.size()==1&&((token[0]>=L'A'&&token[0]<=L'Z')||(token[0]>=L'0'&&token[0]<=L'9')))?token[0]:0;
        if(!key||result.key)throw std::runtime_error("Hotkey must contain one supported key");result.key=key;
    }
    if(!result.key||result.modifiers==MOD_NOREPEAT)throw std::runtime_error("Hotkey requires modifiers and a key");return result;
}
inline wchar_t const* TrayLabel(std::wstring const& language,unsigned command){
    if(language==L"uk")return command==1?L"Показати список":command==2?L"Нове завдання":L"Вихід";
    if(language==L"en")return command==1?L"Show tasks":command==2?L"New task":L"Exit";
    return command==1?L"Показать список":command==2?L"Новая задача":L"Выход";
}
