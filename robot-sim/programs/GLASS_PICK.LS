/PROG  GLASS_PICK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "GLASS PICK AND PLACE";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-07  TIME 11:50:53;
MODIFIED	= DATE 26-11-07  TIME 11:50:53;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 20;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !PICK AND PLACE SAMPLE    ;
   2:  R[1]=0    ;
   3:  J P[1] 50% FINE    ;
   4:  LBL[1]    ;
   5:  WAIT DI[1]=ON    ;
   6:  J P[2] 60% FINE    ;
   7:  L P[3] 200mm/sec FINE    ;
   8:  RO[1]=ON    ;
   9:  WAIT RI[1]=ON    ;
  10:  WAIT 0.20(sec)    ;
  11:  L P[4] 400mm/sec FINE    ;
  12:  J P[5] 60% FINE    ;
  13:  L P[6] 200mm/sec FINE    ;
  14:  RO[1]=OFF    ;
  15:  WAIT RI[1]=OFF    ;
  16:  WAIT 0.30(sec)    ;
  17:  L P[7] 400mm/sec FINE    ;
  18:  J P[8] 60% FINE    ;
  19:  R[1]=R[1]+1    ;
  20:  IF R[1]<3,JMP LBL[1]    ;
/POS
P[1]{
   GP1:
	UF : 0, UT : 1,
	J1=     0.000 deg,	J2=     0.000 deg,	J3=     0.000 deg,
	J4=     0.000 deg,	J5=    90.000 deg,	J6=     0.000 deg
};
P[2]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    455.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[5]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[6]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    455.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[7]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[8]{
   GP1:
	UF : 0, UT : 1,
	J1=     0.000 deg,	J2=     0.000 deg,	J3=     0.000 deg,
	J4=     0.000 deg,	J5=    90.000 deg,	J6=     0.000 deg
};
/END
