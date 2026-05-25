import type { editor } from "monaco-editor";

export const auroraTheme: editor.IStandaloneThemeData =
{
  base: "vs-dark",
  inherit: true,

  rules: [
    {
      token: "keyword",
      foreground: "c792ea",
      fontStyle: "bold",
    },

    {
      token: "string",
      foreground: "ff9e64",
    },

    {
      token: "number",
      foreground: "f78c6c",
    },

    {
      token: "comment",
      foreground: "5c6370",
      fontStyle: "italic",
    },

    {
      token: "type",
      foreground: "7dcfff",
    },

    {
      token: "annotation",
      foreground: "bb9af7",
    },

    {
      token: "delimiter",
      foreground: "89a4c2",
    },

    {
      token: "operator",
      foreground: "89ddff",
    },

    {
      token: "function",
      foreground: "82aaff",
    },

    {
      token: "variable",
      foreground: "c9d1d9",
    },
  ],

  colors: {
    "editor.background": "#05050f",
    "editor.foreground": "#c9d1d9",
  },
};