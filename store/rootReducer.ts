import { combineReducers } from "@reduxjs/toolkit";
import accountData from "@/store/slices/accountSlice";
import ordersData from "@/store/slices/ordersSlice";
import productsData from "@/store/slices/productsSlice";

export const rootReducer = combineReducers({
  productsData,
  ordersData,
  accountData,
});
