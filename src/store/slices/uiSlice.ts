import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface UiState {
  sidebarOpen: boolean;
  activeModal: string | null;
  themePreference: "system" | "light" | "dark";
}

const initialState: UiState = {
  sidebarOpen: false,
  activeModal: null,
  themePreference: "system",
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    openModal: (state, action: PayloadAction<string>) => {
      state.activeModal = action.payload;
    },
    closeModal: (state) => {
      state.activeModal = null;
    },
    setThemePreference: (
      state,
      action: PayloadAction<UiState["themePreference"]>,
    ) => {
      state.themePreference = action.payload;
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  openModal,
  closeModal,
  setThemePreference,
} = uiSlice.actions;

export default uiSlice.reducer;
