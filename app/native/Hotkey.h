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
    // Shift is welcome alongside another modifier, never on its own: a global
    // Shift+letter swallows every capital of that letter system-wide, in every
    // other application, which is indistinguishable from a broken keyboard.
    if(!result.key)throw std::runtime_error("Hotkey requires modifiers and a key");
    if(!(result.modifiers&(MOD_CONTROL|MOD_ALT|MOD_WIN)))throw std::runtime_error("Hotkey needs Ctrl, Alt or Win; Shift alone would capture every capital letter");
    return result;
}
inline wchar_t const* TrayLabel(std::wstring const& language,unsigned command){
    if(language==L"uk")return command==1?L"Показати список":command==2?L"Нове завдання":command==4?L"Знімок екрана (15 с)":command==5?L"Режим демонстрації":L"Вихід";
    if(language==L"en")return command==1?L"Show tasks":command==2?L"New task":command==4?L"Screenshot (15 s)":command==5?L"Demo mode":L"Exit";
    return command==1?L"Показать список":command==2?L"Новая задача":command==4?L"Снимок экрана (15 с)":command==5?L"Режим демонстрации":L"Выход";
}
